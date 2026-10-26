//! The command line's arguments, as clap reads them (`smedcover --help`, `smedcover <command> --help`).

use std::path::PathBuf;

use clap::{Parser, Subcommand};

/// The image formats `--format` takes (`jpg` is `jpeg`).
pub const FORMATS: [&str; 4] = ["png", "jpg", "jpeg", "webp"];

const AFTER_HELP: &str = "\
The work is done by the SmedCover app, through the same tools agents use (MCP): in its open window when it runs \
(you see each step), else in an app started hidden for the command, which quits when it is done.

Exit codes: 0 done; 1 the app answered an error; 2 the command was not right; 3 the app could not be reached or \
started, or needs setting up first; 4 no answer in time; 130 interrupted (Ctrl-C).

Environment: SMEDCOVER_DATA, the data folder (as --data); SMEDCOVER_APP, the app to start when none runs.";

#[derive(Parser, Debug)]
#[command(name = "smedcover", version, about = "Make SmedCover covers from a terminal.", after_help = AFTER_HELP)]
pub struct Cli {
    /// Print the tool's result as JSON
    #[arg(long, global = true)]
    pub json: bool,

    /// Print no progress and no notes (results and errors still)
    #[arg(long, short = 'q', global = true)]
    pub quiet: bool,

    /// Give up on a call after SECS seconds (default: as long as the app keeps working on it)
    #[arg(long, global = true, value_name = "SECS", value_parser = seconds)]
    pub timeout: Option<f64>,

    /// The data folder the app works on (default: the app's own)
    #[arg(long, global = true, value_name = "DIR", env = "SMEDCOVER_DATA", hide_env_values = true)]
    pub data: Option<PathBuf>,

    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand, Debug)]
pub enum Command {
    /// List the profiles, with their channels and sizes
    Profiles,

    /// Write one channel's cover at one size to a file
    Render {
        /// The channel: its id, name, code or number from 1
        channel: String,
        /// The profile, by id or name (default: the one shown)
        #[arg(long, value_name = "PROFILE")]
        profile: Option<String>,
        /// The size: its pixels (1920x1080), ratio (16:9) or name (default: the one on the canvas)
        #[arg(long, value_name = "SIZE", conflicts_with = "size_key")]
        size: Option<String>,
        /// The size by its key, as `smedcover profiles` lists it
        #[arg(long, value_name = "KEY")]
        size_key: Option<String>,
        /// The image format (default: the file's extension, else the export settings')
        #[arg(long, value_parser = FORMATS)]
        format: Option<String>,
        /// The resolution, 1 to 4 times the size's pixels (default: the export settings')
        #[arg(long, value_parser = clap::value_parser!(u8).range(1..=4))]
        scale: Option<u8>,
        /// The file to write (replaced if it is there)
        #[arg(short = 'o', long = "output", value_name = "FILE", required = true)]
        output: PathBuf,
    },

    /// Export covers into a folder, never over a file
    Export {
        /// The profile, by id or name (default: the one shown)
        #[arg(long, value_name = "PROFILE")]
        profile: Option<String>,
        /// The channels, by id, name, code or number, comma-separated, or `all` (default: the one shown)
        #[arg(long, value_name = "LIST")]
        channels: Option<String>,
        /// The sizes, by pixels, ratio or name, comma-separated, or `all` (default: those ticked in Export)
        #[arg(long, value_name = "LIST")]
        sizes: Option<String>,
        /// The image format (default: the export settings')
        #[arg(long, value_parser = FORMATS)]
        format: Option<String>,
        /// The resolution, 1 to 4 (default: the export settings')
        #[arg(long, value_parser = clap::value_parser!(u8).range(1..=4))]
        scale: Option<u8>,
        /// The folder to write into, made if it is not there (default: the profile's export folder)
        #[arg(long, value_name = "DIR")]
        out: Option<PathBuf>,
    },

    /// Make a cover for each row of a CSV (channel, title, tag, subtitle) and export them
    Batch {
        /// The CSV file, its header row optional; `-` reads it from the standard input
        csv: PathBuf,
        /// The profile, by id or name (default: the one shown)
        #[arg(long, value_name = "PROFILE")]
        profile: Option<String>,
        /// The sizes, comma-separated, or `all` (default: every size of the profile)
        #[arg(long, value_name = "LIST")]
        sizes: Option<String>,
        /// The image format (default: the export settings')
        #[arg(long, value_parser = FORMATS)]
        format: Option<String>,
        /// The resolution, 1 to 4 (default: the export settings')
        #[arg(long, value_parser = clap::value_parser!(u8).range(1..=4))]
        scale: Option<u8>,
        /// The folder to write into, made if it is not there (default: the profile's export folder)
        #[arg(long, value_name = "DIR")]
        out: Option<PathBuf>,
    },

    /// Open a project file (.smedcover.json) in the app
    Import {
        /// The project file
        file: PathBuf,
        /// Where it goes when its profile is not here: a new profile, or over the current one
        #[arg(long = "as", value_name = "new|current", value_parser = ["new", "current"])]
        into: Option<String>,
    },

    /// List the app's tools
    Tools,

    /// Call any tool with arguments as JSON
    Call {
        /// The tool's name, as `smedcover tools` lists it
        tool: String,
        /// Its arguments, a JSON object; `-` reads them from the standard input (default: none)
        arguments: Option<String>,
        /// Save the images it answers with into DIR (else they are only described)
        #[arg(long, value_name = "DIR")]
        save_images: Option<PathBuf>,
    },
}

/// A number of seconds above 0.
fn seconds(text: &str) -> Result<f64, String> {
    match text.trim().parse::<f64>() {
        Ok(s) if s > 0.0 && s.is_finite() && s <= 1e9 => Ok(s),
        _ => Err("a number of seconds above 0".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    fn parse(args: &[&str]) -> Result<Cli, clap::Error> {
        Cli::try_parse_from(std::iter::once("smedcover").chain(args.iter().copied()))
    }

    #[test]
    fn the_definition_holds_together() {
        Cli::command().debug_assert();
    }

    #[test]
    fn global_flags_go_before_or_after_the_command() {
        let cli = parse(&["--json", "profiles", "--quiet", "--timeout", "2.5"]).unwrap();
        assert!(cli.json && cli.quiet);
        assert_eq!(cli.timeout, Some(2.5));
        assert!(matches!(cli.command, Command::Profiles));
    }

    #[test]
    fn refuses_what_is_wrong() {
        let refused = |args: &[&str]| {
            let e = parse(args).expect_err(&format!("{args:?} should be refused"));
            assert_eq!(e.exit_code(), 2, "{args:?}: {e}");
        };
        refused(&["render", "1"]); // no -o
        refused(&["render", "1", "-o", "a.png", "--size", "16:9", "--size-key", "1920x1080"]);
        refused(&["render", "1", "-o", "a.png", "--format", "gif"]);
        refused(&["export", "--scale", "5"]);
        refused(&["export", "--scale", "0"]);
        refused(&["import", "p.smedcover.json", "--as", "old"]);
        refused(&["profiles", "--timeout", "0"]);
        refused(&["profiles", "--timeout", "soon"]);
        refused(&["nope"]);
        refused(&[]);
        refused(&["call"]);
    }

    #[test]
    fn reads_each_command() {
        match parse(&["render", "VLOG", "--profile", "Mine", "--size", "16:9", "--format", "jpg", "--scale", "2", "-o", "x.jpg"]).unwrap().command {
            Command::Render { channel, profile, size, size_key, format, scale, output } => {
                assert_eq!((channel.as_str(), profile.as_deref(), size.as_deref(), size_key), ("VLOG", Some("Mine"), Some("16:9"), None));
                assert_eq!((format.as_deref(), scale, output), (Some("jpg"), Some(2), PathBuf::from("x.jpg")));
            }
            other => panic!("{other:?}"),
        }
        match parse(&["call", "set_text", "{\"title\":\"x\"}", "--save-images", "imgs"]).unwrap().command {
            Command::Call { tool, arguments, save_images } => {
                assert_eq!((tool.as_str(), arguments.as_deref(), save_images), ("set_text", Some("{\"title\":\"x\"}"), Some(PathBuf::from("imgs"))));
            }
            other => panic!("{other:?}"),
        }
        assert!(matches!(parse(&["import", "a.smedcover.json", "--as", "current"]).unwrap().command, Command::Import { into: Some(i), .. } if i == "current"));
        assert!(matches!(parse(&["batch", "-"]).unwrap().command, Command::Batch { csv, .. } if csv.as_os_str() == "-"));
    }

    #[test]
    fn help_and_version_are_not_failures() {
        assert_eq!(parse(&["--help"]).unwrap_err().exit_code(), 0);
        let version = parse(&["--version"]).unwrap_err();
        assert_eq!(version.exit_code(), 0);
        assert!(version.to_string().contains(env!("CARGO_PKG_VERSION")));
    }
}
