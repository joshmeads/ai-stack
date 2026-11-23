package p

func f() {
	_ = 1 //nolint:errcheck @hit
	// a normal comment
}
// ast-grep-ignore @hit
// mentions ast-grep-ignore in prose
