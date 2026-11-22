// SPDX-License-Identifier: MIT
/// Doc on pub fn.
pub fn a() {}

/// Doc then attribute.
#[must_use]
pub fn b() -> u8 { 1 }

/// First doc line.
/// Second doc line.
pub fn c() {}

/// Doc on private fn. @hit
fn d() {}

// prose comment @hit
pub fn e() {}

/// Doc on pub(crate). @hit
pub(crate) fn f() {}

pub struct S {
    /// Doc on pub field.
    pub x: u8,
    /// Doc on private field. @hit
    y: u8,
}

/// Doc on pub enum.
pub enum E {
    /// Doc on variant of pub enum.
    A,
}

/// Doc on pub trait.
pub trait T {
    /// Doc on trait method.
    fn m(&self);
}

impl S {
    /// Doc on pub method.
    pub fn new() -> Self { S { x: 0, y: 0 } }
    /* block prose @hit */
    fn private(&self) {}
}

// SAFETY: the pointer is valid for the whole call
fn g() {}

fn h() {
    let x = 1; // trailing prose @hit
    /* block @hit */
}
