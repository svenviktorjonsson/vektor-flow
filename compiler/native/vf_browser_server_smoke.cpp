#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib, "Ws2_32.lib")
using SocketHandle = SOCKET;
constexpr SocketHandle invalid_socket_handle = INVALID_SOCKET;
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
using SocketHandle = int;
constexpr SocketHandle invalid_socket_handle = -1;
#endif

namespace {

class ServerFailure : public std::runtime_error {
public:
    explicit ServerFailure(std::string message)
        : std::runtime_error(std::move(message)) {}
};

struct Args {
    std::filesystem::path serve_dir;
    int port = 0;
    std::filesystem::path state_path;
};

void close_socket(SocketHandle handle) {
#ifdef _WIN32
    if (handle != INVALID_SOCKET) {
        closesocket(handle);
    }
#else
    if (handle >= 0) {
        close(handle);
    }
#endif
}

std::string read_file(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        throw ServerFailure("could not read " + path.string());
    }
    std::ostringstream buffer;
    buffer << input.rdbuf();
    return buffer.str();
}

void write_file(const std::filesystem::path& path, const std::string& text) {
    std::filesystem::create_directories(path.parent_path());
    std::ofstream output(path, std::ios::binary);
    if (!output) {
        throw ServerFailure("could not write " + path.string());
    }
    output << text;
}

std::string guess_content_type(const std::filesystem::path& path) {
    const std::string ext = path.extension().string();
    if (ext == ".html") return "text/html; charset=utf-8";
    if (ext == ".js") return "application/javascript; charset=utf-8";
    if (ext == ".css") return "text/css; charset=utf-8";
    if (ext == ".json") return "application/json; charset=utf-8";
    if (ext == ".svg") return "image/svg+xml";
    if (ext == ".png") return "image/png";
    if (ext == ".wasm") return "application/wasm";
    return "application/octet-stream";
}

std::string normalize_url_path(std::string path) {
    if (path.empty() || path == "/") {
        return "/index.html";
    }
    auto query = path.find('?');
    if (query != std::string::npos) {
        path = path.substr(0, query);
    }
    if (path.front() != '/') {
        path.insert(path.begin(), '/');
    }
    return path;
}

std::filesystem::path resolve_path(const std::filesystem::path& serve_dir, const std::string& request_path) {
    std::filesystem::path rel = std::filesystem::path(request_path.substr(1)).lexically_normal();
    if (rel.empty()) {
        rel = "index.html";
    }
    for (const auto& part : rel) {
        if (part == "..") {
            throw ServerFailure("path traversal rejected");
        }
    }
    return (serve_dir / rel).lexically_normal();
}

std::string make_response(
    int status,
    const std::string& reason,
    const std::string& body,
    const std::string& content_type
) {
    std::ostringstream out;
    out << "HTTP/1.1 " << status << " " << reason << "\r\n";
    out << "Content-Type: " << content_type << "\r\n";
    out << "Content-Length: " << body.size() << "\r\n";
    out << "Cache-Control: no-store\r\n";
    out << "Connection: close\r\n\r\n";
    out << body;
    return out.str();
}

Args parse_args(int argc, char** argv) {
    Args args;
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--serve-dir" && i + 1 < argc) {
            args.serve_dir = argv[++i];
            continue;
        }
        if (arg == "--port" && i + 1 < argc) {
            args.port = std::stoi(argv[++i]);
            continue;
        }
        if (arg == "--state-path" && i + 1 < argc) {
            args.state_path = argv[++i];
            continue;
        }
        throw ServerFailure("usage: vf-browser-server --serve-dir <dir> --port <port> --state-path <path>");
    }
    if (args.serve_dir.empty() || args.port <= 0 || args.state_path.empty()) {
        throw ServerFailure("usage: vf-browser-server --serve-dir <dir> --port <port> --state-path <path>");
    }
    return args;
}

}  // namespace

int main(int argc, char** argv) {
    try {
        const Args args = parse_args(argc, argv);
#ifdef _WIN32
        WSADATA wsa_data;
        if (WSAStartup(MAKEWORD(2, 2), &wsa_data) != 0) {
            throw ServerFailure("WSAStartup failed");
        }
#endif

        SocketHandle server = socket(AF_INET, SOCK_STREAM, 0);
        if (server == invalid_socket_handle) {
            throw ServerFailure("socket() failed");
        }

        int reuse = 1;
        setsockopt(server, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<const char*>(&reuse), sizeof(reuse));

        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_port = htons(static_cast<unsigned short>(args.port));
        addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        if (bind(server, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0) {
            close_socket(server);
            throw ServerFailure("bind() failed");
        }
        if (listen(server, 8) != 0) {
            close_socket(server);
            throw ServerFailure("listen() failed");
        }

        write_file(args.state_path, "{\"port\": " + std::to_string(args.port) + "}\n");
        std::cout << "serving " << args.serve_dir.string() << " on 127.0.0.1:" << args.port << "\n";
        std::cout.flush();

        for (;;) {
            sockaddr_in client_addr{};
#ifdef _WIN32
            int client_len = sizeof(client_addr);
#else
            socklen_t client_len = sizeof(client_addr);
#endif
            SocketHandle client = accept(server, reinterpret_cast<sockaddr*>(&client_addr), &client_len);
            if (client == invalid_socket_handle) {
                continue;
            }

            char buffer[4096];
#ifdef _WIN32
            const int received = recv(client, buffer, static_cast<int>(sizeof(buffer)), 0);
#else
            const int received = static_cast<int>(recv(client, buffer, sizeof(buffer), 0));
#endif
            std::string response;
            if (received <= 0) {
                response = make_response(400, "Bad Request", "bad request", "text/plain; charset=utf-8");
            } else {
                std::string request(buffer, buffer + received);
                const auto line_end = request.find("\r\n");
                const std::string line = request.substr(0, line_end);
                const auto first_space = line.find(' ');
                const auto second_space = first_space == std::string::npos ? std::string::npos : line.find(' ', first_space + 1);
                if (first_space == std::string::npos || second_space == std::string::npos || line.substr(0, first_space) != "GET") {
                    response = make_response(405, "Method Not Allowed", "only GET supported", "text/plain; charset=utf-8");
                } else {
                    try {
                        const std::string path = normalize_url_path(line.substr(first_space + 1, second_space - first_space - 1));
                        const auto file_path = resolve_path(args.serve_dir, path);
                        if (!std::filesystem::exists(file_path) || !std::filesystem::is_regular_file(file_path)) {
                            response = make_response(404, "Not Found", "not found", "text/plain; charset=utf-8");
                        } else {
                            response = make_response(200, "OK", read_file(file_path), guess_content_type(file_path));
                        }
                    } catch (const std::exception&) {
                        response = make_response(400, "Bad Request", "bad path", "text/plain; charset=utf-8");
                    }
                }
            }

#ifdef _WIN32
            send(client, response.data(), static_cast<int>(response.size()), 0);
#else
            send(client, response.data(), response.size(), 0);
#endif
            close_socket(client);
        }
    } catch (const std::exception& exc) {
        std::cerr << "<vf-browser-server>:1:1: " << exc.what() << "\n";
        return 1;
    }
}
