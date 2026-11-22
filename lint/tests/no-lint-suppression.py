import os  # noqa: F401 @hit
x: int = "a"  # type: ignore[assignment] @hit
y = 1  # pylint: disable=invalid-name @hit
# a normal comment
z = 2  # type: int
