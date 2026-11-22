package cmath

// #cgo LDFLAGS: -lm
// #include <math.h>
import "C"

/*
#include <stdlib.h>
*/
import "C"

// prose before an ordinary import @hit
import "fmt"

func Sqrt(x float64) float64 { return float64(C.sqrt(C.double(x))) }

func ExampleSqrt() {
	fmt.Println(Sqrt(4))
	// Output:
	// 2
}

func ExampleKeys() {
	fmt.Println("a")
	fmt.Println("b")
	// Unordered output:
	// b
	// a
}

func ExampleTrail() {
	// prose before the body @hit
	fmt.Println(1)
	// Output: 1
}

func helperSqrt() {
	fmt.Println(1)
	// Output: not an example @hit
}
