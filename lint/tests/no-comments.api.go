package service

type Reader interface {
	// Read returns the next byte.
	Read() byte
	// helper is private @hit
	helper()
}

const (
	// DefaultPort is the service port.
	DefaultPort = 8080
	// localPort is private @hit
	localPort = 1
)

var (
	// Version is exported.
	Version = "1"
)

type (
	// ID is exported.
	ID string
	// key is private @hit
	key string
)
