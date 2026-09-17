# Imagegen 提示词

工具：内置 `imagegen`。原图由首次生成及背景修订得到；透明前景以修订后的原图为输入。以下为实际使用的提示词。

## 1. 主符号设计

```text
Use case: logo-brand. Create a polished, distinctive production Android app icon for 拾迹 (Shiji), a personal work journal and todo app about recording small actions and tracing progress through time. Deliver ONE icon artwork, square 1024x1024, full bleed, suitable as an actual launcher asset, not an icon presentation or mockup.

Design concept: a single sculptural folded ribbon of glass-paper forms an elegant, recognizable vertical S-shaped trail. It should feel like a small paper bookmark folded back twice, with a clear open negative-space channel through the center. Broad, simple, confident geometry with 2 or 3 smoothly connected planes, softly rounded outer corners. A restrained fold at the upper end subtly suggests turning a page. The silhouette alone must be memorable and very legible at 48 pixels. No literal check mark. No dots or decorative sparkles.

Style: premium contemporary app identity, highly art-directed, quiet and refined. A rich luminous cobalt blue outer face, a pale frosted ice-blue upper fold, and a subtle teal-blue inner edge. Controlled translucent glass-paper material, restrained depth and believable soft refraction, fine edge highlights. The form should be substantial and graphic, not a wispy glass ornament, not a realistic object photograph. Frontal orthographic composition, balanced optical center.

Background: very pale cool porcelain, almost white, softly illuminated, solid color reaching every edge with an almost imperceptible ice-blue glow near the symbol. A minimal soft contact shadow under the floating ribbon gives separation. Keep the entire recognizable symbol inside the central 58% of the square, generously clear corners for Android adaptive masks. Design should look excellent on a circular launcher crop as well as a rounded square.

Avoid: lettering, text, numerals, brand wordmark, watermark, frames, outline border, externally rounded square tile, surrounding canvas, multiple concepts, a grid, phone mockups, pens, calendars, clipboard illustrations, checkboxes, generic giant tick, neon rainbow, purple gradient, glossy toy clutter, tiny details. Beautiful crisp edges, restrained lighting, exceptional small-size legibility.
```

## 2. 原图背景修订

```text
Use case: background-extraction / precise-object-edit. This is the selected artwork for the 拾迹 Android app icon. Create the FINAL production icon by correcting the background of this reference. Preserve the exact beautiful folded S-shaped ribbon identity, its proportions, silhouette, cobalt outer face, frosted pale-blue top, cyan inside folds and refined glass-paper shading.
Replace the entire area outside the ribbon with a completely OPAQUE, perfectly clean, very pale porcelain-blue background (#F1F5FB) extending edge to edge. NO transparency, NO vignette, NO dithered halo, NO checkerboard, NO dark surround, NO grain. Only a very subtle short soft shadow immediately beneath the ribbon. Keep a flat clean square canvas without pre-rounded outer corners or a border. Gently scale the same ribbon down so its whole height is 60% of the square canvas, centered optically with equal clear space above and below. Do not redraw or change the mark's construction. Output ONE square launcher icon image, not a mockup; no text and no extra objects. The opaque full-bleed background and the existing distinctive mark are both essential.
```

## 3. Android 透明前景

```text
Use case: background-extraction. Prepare a transparent production foreground layer of this exact icon. Preserve the exact existing folded S-shaped glass-paper ribbon, its precise silhouette, size, centering, cobalt-blue/cyan/frosted ice-blue faces, all folds and internal highlights. Remove ONLY the pale porcelain backdrop, the soft cast shadow and the background glow. Every pixel outside the ribbon must be truly transparent alpha 0, right up to its clean anti-aliased edge. Do not include any diffuse halo, ground plane, checkerboard pattern, surrounding canvas color or added text. The ribbon itself must remain substantial and opaque enough for an app launcher even on dark wallpaper. Keep the square canvas, same composition and optical center. Output one PNG with actual transparent background, not a mockup. This is an exact asset extraction, not a new logo or a change of design.
```
