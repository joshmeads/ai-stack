#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# SPDX-License-Identifier: MIT
import os  # noqa: F401
from typing import List  # type: ignore
# a prose comment @hit


def f():
    # pylint: disable=unused-variable
    x = 1  # trailing prose @hit
    return x
# WARNING: removing this import breaks plugin discovery
# fmt: off
