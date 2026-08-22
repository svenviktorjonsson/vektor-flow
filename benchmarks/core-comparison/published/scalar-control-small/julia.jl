using Printf

function advance(x::Float64, i::Float64)::Float64
    y = x * 1.00000011920929 + i * 0.0000001
    y > 1000.0 ? y - 999.5 : y
end

function run(n::Float64)::Float64
    i = 0.0
    x = 1.0
    while i < n
        x = advance(x, i)
        i += 1.0
    end
    x
end

@printf("%.17g\n", run(20000.0))
