import asyncio
import time


def test_sleeps():
    time.sleep(0.1)  # @hit


async def test_async():
    await asyncio.sleep(0.1)  # @hit


def helper():
    time.sleep(0.1)


class TestThing:
    def test_method(self):
        time.sleep(1)  # @hit
