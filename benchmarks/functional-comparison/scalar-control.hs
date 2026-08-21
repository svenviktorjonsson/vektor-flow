{-# LANGUAGE BangPatterns #-}

import Text.Printf (printf)

advance :: Double -> Double -> Double
advance x i =
    let y = x * 1.00000011920929 + i * 0.0000001
    in if y > 1000.0 then y - 999.5 else y

run :: Double -> Double
run n = loop 0.0 1.0
  where
    loop !i !x
        | i < n = loop (i + 1.0) (advance x i)
        | otherwise = x

main :: IO ()
main = printf "%.17g\n" (run 20000.0)
