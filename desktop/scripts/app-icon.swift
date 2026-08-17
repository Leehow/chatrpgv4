// Generates desktop/buildResources/icon.png from the web frontend brand mark:
// the dark-ink AI KEEPER octopus (ai-keeper-mark-light.png — "light" names the
// theme it serves) centered on the app's cream window background as a
// rounded-square macOS icon. No repo dependencies; needs only the system
// Swift + CoreGraphics. Usage:
//   swift desktop/scripts/app-icon.swift \
//     web/frontend/src/assets/brand/ai-keeper-mark-light.png \
//     desktop/buildResources/icon.png
import Foundation
import CoreGraphics
import ImageIO

let args = CommandLine.arguments
func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}
guard args.count == 3 else {
    fail("usage: app-icon.swift <mark.png> <out.png>")
}
let markURL = URL(fileURLWithPath: args[1])
let outURL = URL(fileURLWithPath: args[2])

guard let source = CGImageSourceCreateWithURL(markURL as CFURL, nil),
      let mark = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fail("cannot read mark image: \(markURL.path)")
}

let size = 1024
let cream = CGColor(srgbRed: 0xF5 / 255.0, green: 0xF1 / 255.0, blue: 0xE8 / 255.0, alpha: 1)
guard let context = CGContext(
    data: nil,
    width: size,
    height: size,
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: CGColorSpace(name: CGColorSpace.sRGB)!,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else {
    fail("cannot create bitmap context")
}

// Full-bleed rounded square (macOS squircle approximation, ~22.4% radius).
let bounds = CGRect(x: 0, y: 0, width: size, height: size)
let shape = CGPath(
    roundedRect: bounds,
    cornerWidth: Double(size) * 0.2237,
    cornerHeight: Double(size) * 0.2237,
    transform: nil
)
context.addPath(shape)
context.setFillColor(cream)
context.fillPath()

// Mark centered at 72% of the icon width.
let markWidth = Double(size) * 0.72
let markScale = markWidth / Double(mark.width)
let markHeight = Double(mark.height) * markScale
let markRect = CGRect(
    x: (Double(size) - markWidth) / 2,
    y: (Double(size) - markHeight) / 2,
    width: markWidth,
    height: markHeight
)
context.interpolationQuality = .high
context.clip(to: markRect) // keep drawing inside the mark's own box
context.draw(mark, in: markRect)

guard let image = context.makeImage(),
      let destination = CGImageDestinationCreateWithURL(outURL as CFURL, "public.png" as CFString, 1, nil)
else {
    fail("cannot encode output image")
}
CGImageDestinationAddImage(destination, image, nil)
guard CGImageDestinationFinalize(destination) else {
    fail("cannot write \(outURL.path)")
}
print("wrote \(outURL.path)")
