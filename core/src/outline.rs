//! Tracing lettering: the outlines of a text's glyphs, for effects that reshape the letters (the
//! fonts they are set in are found by [`crate::Core::text_outline`]).

use std::sync::Arc;

use serde::Serialize;

/// One glyph of a traced text: how far the pen moves on (in ems), and its outline as closed
/// polylines `[x0, y0, x1, y1, …]` in ems with y pointing down, curves already flattened.
#[derive(Serialize, Debug, PartialEq)]
pub struct Glyph {
    pub adv: f32,
    pub c: Vec<Vec<f32>>,
}

/// A traced text. `missing` is set when some character had no glyph in any of the fonts.
#[derive(Serialize, Debug)]
pub struct Outline {
    pub glyphs: Vec<Glyph>,
    pub missing: bool,
}

/// Collects a glyph's outline as polylines, scaled to ems and flipped to y-down.
struct Flatten {
    k: f32,
    done: Vec<Vec<f32>>,
    cur: Vec<f32>,
    at: (f32, f32),
}

impl Flatten {
    fn push(&mut self, x: f32, y: f32) {
        self.cur.push((x * self.k * 1e4).round() / 1e4);
        self.cur.push((-y * self.k * 1e4).round() / 1e4);
        self.at = (x, y);
    }
    fn finish(&mut self) {
        if self.cur.len() >= 6 {
            self.done.push(std::mem::take(&mut self.cur));
        } else {
            self.cur.clear();
        }
    }
}

impl ttf_parser::OutlineBuilder for Flatten {
    fn move_to(&mut self, x: f32, y: f32) {
        self.finish();
        self.push(x, y);
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.push(x, y);
    }
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        let (x0, y0) = self.at;
        for i in 1..=6 {
            let t = i as f32 / 6.0;
            let u = 1.0 - t;
            self.push(
                u * u * x0 + 2.0 * u * t * x1 + t * t * x,
                u * u * y0 + 2.0 * u * t * y1 + t * t * y,
            );
        }
    }
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        let (x0, y0) = self.at;
        for i in 1..=8 {
            let t = i as f32 / 8.0;
            let u = 1.0 - t;
            self.push(
                u * u * u * x0 + 3.0 * u * u * t * x1 + 3.0 * u * t * t * x2 + t * t * t * x,
                u * u * u * y0 + 3.0 * u * u * t * y1 + 3.0 * u * t * t * y2 + t * t * t * y,
            );
        }
    }
    fn close(&mut self) {
        self.finish();
    }
}

/// Traces `text` with the first of `fonts` (font file bytes and face index) that has each
/// character, at `weight` where a font is variable. No shaping: one glyph per character, laid
/// side by side — which is all headline lettering needs.
pub fn trace(text: &str, fonts: &[Arc<(Vec<u8>, u32)>], weight: f32) -> Outline {
    let faces: Vec<ttf_parser::Face> = fonts
        .iter()
        .filter_map(|f| ttf_parser::Face::parse(&f.0, f.1).ok())
        .map(|mut face| {
            if face.is_variable() {
                face.set_variation(ttf_parser::Tag::from_bytes(b"wght"), weight);
            }
            face
        })
        .collect();
    let mut glyphs = Vec::new();
    let mut missing = false;
    for ch in text.chars() {
        let found = faces
            .iter()
            .find_map(|face| face.glyph_index(ch).map(|id| (face, id)));
        match found {
            Some((face, id)) => {
                let k = 1.0 / f32::from(face.units_per_em());
                let mut flat = Flatten {
                    k,
                    done: Vec::new(),
                    cur: Vec::new(),
                    at: (0.0, 0.0),
                };
                face.outline_glyph(id, &mut flat);
                flat.finish();
                let adv = f32::from(face.glyph_hor_advance(id).unwrap_or(0)) * k;
                glyphs.push(Glyph { adv, c: flat.done });
            }
            None => {
                missing = missing || !ch.is_whitespace();
                glyphs.push(Glyph {
                    adv: 0.3,
                    c: Vec::new(),
                });
            }
        }
    }
    Outline { glyphs, missing }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fonts::tests::bundled;

    #[test]
    fn trace_gives_closed_outlines_in_ems() {
        let out = trace("Ab 1", &[bundled("BebasNeue-Regular.ttf")], 400.0);
        assert!(!out.missing);
        assert_eq!(out.glyphs.len(), 4);
        assert!(out.glyphs[2].c.is_empty() && out.glyphs[2].adv > 0.05); // the space: no outline, some advance
        for g in [&out.glyphs[0], &out.glyphs[1], &out.glyphs[3]] {
            assert!(g.adv > 0.2 && g.adv < 1.2, "advance {}", g.adv);
            assert!(!g.c.is_empty());
            for contour in &g.c {
                assert!(contour.len() >= 6 && contour.len() % 2 == 0);
                for (i, v) in contour.iter().enumerate() {
                    // within the em box, and above the baseline (y points down, so negative) for capitals
                    assert!(v.is_finite() && *v > -1.5 && *v < 1.5, "coordinate {v}");
                    if i % 2 == 1 {
                        assert!(*v <= 0.05, "a capital dips below the baseline: {v}");
                    }
                }
            }
        }
        assert_eq!(out.glyphs[0].c.len(), 2); // "A": the outside and the counter
    }

    #[test]
    fn trace_falls_back_between_fonts_and_follows_the_weight() {
        let fonts = [bundled("BebasNeue-Regular.ttf"), bundled("NotoSansSC.ttf")];
        let out = trace("A夜", &fonts, 900.0);
        assert!(!out.missing);
        assert!(!out.glyphs[1].c.is_empty()); // the CJK glyph came from the second font
        assert!((out.glyphs[1].adv - 1.0).abs() < 0.05); // full width
                                                         // a variable font is heavier at 900 than at 100: its strokes reach further
        let reach = |weight: f32| {
            let g = &trace("夜", &fonts[1..], weight).glyphs[0];
            let xs: Vec<f32> =
                g.c.iter()
                    .flat_map(|c| c.iter().step_by(2).copied())
                    .collect();
            let area: f32 =
                g.c.iter()
                    .map(|c| {
                        let n = c.len() / 2;
                        (0..n)
                            .map(|i| {
                                let j = (i + 1) % n;
                                c[2 * i] * c[2 * j + 1] - c[2 * j] * c[2 * i + 1]
                            })
                            .sum::<f32>()
                            / 2.0
                    })
                    .sum();
            (xs.len(), area.abs())
        };
        assert!(
            reach(900.0).1 > reach(100.0).1 * 1.5,
            "{:?} vs {:?}",
            reach(900.0),
            reach(100.0)
        );
        // a character no font has
        let none = trace("A\u{10FFFF}", &fonts[..1], 400.0);
        assert!(none.missing && none.glyphs.len() == 2);
    }
}
