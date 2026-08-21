module FunctionalBench

let advance x i =
    let y = x * 1.00000011920929 + i * 0.0000001
    if y > 1000.0 then y - 999.5 else y

let run n =
    let rec loop i x =
        if i < n then loop (i + 1.0) (advance x i) else x
    loop 0.0 1.0

[<EntryPoint>]
let main _ =
    printfn "%.17g" (run 20000.0)
    0
