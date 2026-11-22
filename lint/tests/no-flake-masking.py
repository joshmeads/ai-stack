import pytest


@pytest.mark.flaky(reruns=3)  # @hit
def test_a():
    pass


@pytest.mark.timeout(60)  # @hit
def test_b():
    pass


@pytest.mark.parametrize("x", [1])
def test_c(x):
    pass


pytest.main(["-p", "rerunfailures"], reruns=2)  # @hit
