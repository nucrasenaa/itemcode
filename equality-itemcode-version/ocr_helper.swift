import Foundation
import Vision
import AppKit

let arguments = CommandLine.arguments
guard arguments.count > 1 else {
    FileHandle.standardError.write(Data("Usage: ocr_helper <image-path> [--fast]\n".utf8))
    exit(1)
}

let imagePath = arguments[1]
let imageURL = URL(fileURLWithPath: imagePath)

guard let ciImage = CIImage(contentsOf: imageURL) else {
    FileHandle.standardError.write(Data("Error: Could not load image from path: \(imagePath)\n".utf8))
    exit(1)
}

let requestHandler = VNImageRequestHandler(ciImage: ciImage, options: [:])

let request = VNRecognizeTextRequest { (request, error) in
    if let error = error {
        FileHandle.standardError.write(Data("OCR Error: \(error.localizedDescription)\n".utf8))
        exit(1)
    }
    
    guard let observations = request.results as? [VNRecognizedTextObservation] else {
        return
    }
    
    for observation in observations {
        guard let topCandidate = observation.topCandidates(1).first else { continue }
        print(topCandidate.string)
    }
}

// Fast mode avoids the accurate model/Neural Engine path if it stalls.
request.recognitionLevel = arguments.contains("--fast") ? .fast : .accurate
request.recognitionLanguages = ["en-US"]
request.usesLanguageCorrection = false

do {
    try requestHandler.perform([request])
} catch {
    FileHandle.standardError.write(Data("Failed to perform OCR request: \(error.localizedDescription)\n".utf8))
    exit(1)
}
