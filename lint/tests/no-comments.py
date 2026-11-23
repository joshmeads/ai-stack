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
# flake8: noqa
import json  # ty: ignore[unresolved-import]
import re  # pyrefly: ignore
# yapf: disable
# fmt: skip
