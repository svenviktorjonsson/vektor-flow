using LinearAlgebra

function spectral_norm(n)
    indices = collect(0:n-1)
    a = [1.0 / (((row + column) * (row + column + 1) ÷ 2) + row + 1)
         for row in indices, column in indices]
    u = ones(Float64, n)
    v = zeros(Float64, n)
    for _ in 1:10
        v = transpose(a) * (a * u)
        u = transpose(a) * (a * v)
    end
    sqrt(dot(u, v) / dot(v, v))
end

println(repr(spectral_norm(100)))
