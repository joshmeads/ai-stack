import pytest

pytestmark = pytest.mark.flaky(reruns=2)  # @hit


@pytest.mark.flaky(reruns=3, reruns_delay=1)  # @hit
def test_a():
    pass


def test_b(runner):
    runner.run(max_runs=4)  # @hit


pytest.main(["-p", "rerunfailures"], reruns=2)  # @hit
