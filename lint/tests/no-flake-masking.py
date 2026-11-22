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


def start_job(queue, max_runs):
    return queue.enqueue("reindex", max_runs=max_runs, reruns=0)
