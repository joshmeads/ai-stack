#[cfg(test)]
mod tests {
    #[test]
    fn sleeps() { std::thread::sleep(std::time::Duration::from_millis(5)); } // @hit

    #[test]
    #[ignore]
    fn sleeps_ignored() { std::thread::sleep(std::time::Duration::from_millis(5)); } // @hit

    #[ignore]
    #[test]
    fn ignored_then_test() { std::thread::sleep(std::time::Duration::from_millis(5)); } // @hit

    #[tokio::test]
    async fn sleeps_async() { tokio::time::sleep(std::time::Duration::from_millis(5)).await; } // @hit

    fn helper() { std::thread::sleep(std::time::Duration::from_millis(5)); }
}

#[cfg(test)]
fn cfg_test_helper() { std::thread::sleep(std::time::Duration::from_millis(5)); }
