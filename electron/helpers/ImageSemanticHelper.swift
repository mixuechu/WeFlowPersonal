import Foundation
import ImageIO
import Vision

struct SemanticLabel: Codable {
    let identifier: String
    let confidence: Float
}

struct SemanticResult: Codable {
    let labels: [SemanticLabel]
}

func emit(_ result: SemanticResult) {
    let encoder = JSONEncoder()
    guard let data = try? encoder.encode(result),
          let json = String(data: data, encoding: .utf8) else {
        FileHandle.standardOutput.write(Data("{\"labels\":[]}".utf8))
        return
    }
    FileHandle.standardOutput.write(Data(json.utf8))
}

guard CommandLine.arguments.count >= 2 else {
    emit(SemanticResult(labels: []))
    exit(2)
}

let imageURL = URL(fileURLWithPath: CommandLine.arguments[1])
guard let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    emit(SemanticResult(labels: []))
    exit(3)
}

let request = VNClassifyImageRequest()
let handler = VNImageRequestHandler(cgImage: image, options: [:])

do {
    try handler.perform([request])
    let labels = (request.results ?? [])
        .filter { $0.confidence >= 0.05 }
        .prefix(16)
        .map { SemanticLabel(identifier: $0.identifier, confidence: $0.confidence) }
    emit(SemanticResult(labels: Array(labels)))
} catch {
    emit(SemanticResult(labels: []))
    exit(4)
}
