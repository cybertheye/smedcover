//! `smedcover`: see the library (src/lib.rs) and README.md's *Command line*.

fn main() {
    std::process::exit(smedcover_cli::main_with(std::env::args_os()));
}
