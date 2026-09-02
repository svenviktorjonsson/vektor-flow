#pragma once

#include "native/material/vf_forest_spatial_sampling_prepared.hpp"

#include <atomic>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <mutex>
#include <stdexcept>
#include <thread>
#include <utility>
#include <vector>

namespace vf::material {

class ForestSpatialSamplingExecutorReference {
public:
    explicit ForestSpatialSamplingExecutorReference(
        std::size_t worker_count
    ) : worker_count_(ValidateWorkerCount(worker_count)) {
        workers_.reserve(worker_count_);
        try {
            for (std::size_t worker = 0;
                 worker < worker_count_;
                 ++worker) {
                workers_.emplace_back([this]() { WorkerLoop(); });
            }
        } catch (...) {
            StopWorkers();
            JoinWorkers();
            throw;
        }
    }

    ~ForestSpatialSamplingExecutorReference() {
        std::lock_guard<std::mutex> run_lock(run_mutex_);
        StopWorkers();
        JoinWorkers();
    }

    ForestSpatialSamplingExecutorReference(
        const ForestSpatialSamplingExecutorReference&
    ) = delete;
    ForestSpatialSamplingExecutorReference& operator=(
        const ForestSpatialSamplingExecutorReference&
    ) = delete;

    std::size_t worker_count() const noexcept {
        return worker_count_;
    }

    ForestSpatialParallelSamplingReport sample(
        const PreparedForestSpatialSamplingReference& prepared
    ) {
        if (prepared.population == nullptr ||
            prepared.blocks.empty()) {
            throw std::invalid_argument(
                "forest executor preparation is invalid"
            );
        }
        std::lock_guard<std::mutex> run_lock(run_mutex_);
        std::unique_lock<std::mutex> state_lock(state_mutex_);
        job_ = &prepared;
        completed_.clear();
        completed_.resize(prepared.blocks.size());
        next_block_.store(0, std::memory_order_relaxed);
        unfinished_workers_ = worker_count_;
        worker_error_ = nullptr;
        ++generation_;
        work_ready_.notify_all();
        work_done_.wait(
            state_lock,
            [this]() { return unfinished_workers_ == 0; }
        );
        job_ = nullptr;
        if (worker_error_ != nullptr) {
            auto error = worker_error_;
            completed_.clear();
            state_lock.unlock();
            std::rethrow_exception(error);
        }
        auto completed = std::move(completed_);
        state_lock.unlock();
        auto result =
            FinalizeForestSpatialSamplingBlocksReference(
                *prepared.population,
                prepared.pair_budget,
                prepared.population_version,
                std::move(completed)
            );
        return {
            std::move(result),
            prepared.blocks.size(),
            worker_count_,
        };
    }

private:
    static std::size_t ValidateWorkerCount(
        std::size_t worker_count
    ) {
        if (worker_count == 0 || worker_count > 64) {
            throw std::invalid_argument(
                "forest executor worker count is invalid"
            );
        }
        return worker_count;
    }

    void WorkerLoop() noexcept {
        std::uint64_t seen_generation = 0;
        while (true) {
            std::unique_lock<std::mutex> state_lock(state_mutex_);
            work_ready_.wait(
                state_lock,
                [this, seen_generation]() {
                    return stopping_ ||
                        generation_ != seen_generation;
                }
            );
            if (stopping_) return;
            seen_generation = generation_;
            const auto* prepared = job_;
            state_lock.unlock();
            try {
                while (true) {
                    const std::size_t index = next_block_.fetch_add(
                        1,
                        std::memory_order_relaxed
                    );
                    if (index >= prepared->blocks.size()) break;
                    completed_[index] =
                        EvaluateForestSpatialObservedBlockReference(
                            prepared->near_squared,
                            prepared->far_squared,
                            prepared->observations,
                            prepared->blocks[index]
                        );
                }
            } catch (...) {
                state_lock.lock();
                if (worker_error_ == nullptr) {
                    worker_error_ = std::current_exception();
                }
                state_lock.unlock();
            }
            state_lock.lock();
            --unfinished_workers_;
            if (unfinished_workers_ == 0) work_done_.notify_one();
        }
    }

    void StopWorkers() noexcept {
        {
            std::lock_guard<std::mutex> state_lock(state_mutex_);
            stopping_ = true;
        }
        work_ready_.notify_all();
    }

    void JoinWorkers() noexcept {
        for (auto& worker : workers_) {
            if (worker.joinable()) worker.join();
        }
    }

    const std::size_t worker_count_;
    std::vector<std::thread> workers_;
    std::mutex run_mutex_;
    std::mutex state_mutex_;
    std::condition_variable work_ready_;
    std::condition_variable work_done_;
    bool stopping_ = false;
    std::uint64_t generation_ = 0;
    const PreparedForestSpatialSamplingReference* job_ = nullptr;
    std::atomic<std::size_t> next_block_{0};
    std::size_t unfinished_workers_ = 0;
    std::exception_ptr worker_error_;
    std::vector<ForestSpatialSamplingBlockResult> completed_;
};

}  // namespace vf::material
