import Foundation
import Vision
import AppKit

let arguments = CommandLine.arguments
guard arguments.count > 1 else {
    print("Usage: ocr_helper <image-path>")
    exit(1)
}

let imagePath = arguments[1]
let imageURL = URL(fileURLWithPath: imagePath)

guard let ciImage = CIImage(contentsOf: imageURL) else {
    print("Error: Could not load image from path: \(imagePath)")
    exit(1)
}

let requestHandler = VNImageRequestHandler(ciImage: ciImage, options: [:])

let request = VNRecognizeTextRequest { (request, error) in
    if let error = error {
        print("OCR Error: \(error.localizedDescription)")
        return
    }
    
    guard let observations = request.results as? [VNRecognizedTextObservation] else {
        return
    }
    
    for observation in observations {
        guard let topCandidate = observation.topCandidates(1).first else { continue }
        print(topCandidate.string)
    }
}

request.recognitionLevel = .accurate
request.recognitionLanguages = ["en-US"]
request.usesLanguageCorrection = false

do {
    try requestHandler.perform([request])
} catch {
    print("Failed to perform OCR request: \(error.localizedDescription)")
    exit(1)
}
