import Carbon
import Foundation
import AppKit

struct MailboxSelector: Codable {
    let accountId: String
    let accountName: String
    let path: [String]
}

struct MailboxInfo: Encodable {
    let id: String
    let accountId: String
    let accountName: String
    let path: [String]
    let displayName: String
}

struct MailMessage: Encodable {
    let id: String
    let messageId: String
    let accountId: String
    let mailboxId: String
    let mailboxName: String
    let subject: String
    let sender: String
    let to: [String]
    let cc: [String]
    let receivedAt: String
    let sentAt: String
    let content: String
    let read: Bool
    let flagged: Bool
    let size: Int
    let attachmentNames: [String]
}

struct Output: Encodable {
    let success: Bool
    var authorization: String? = nil
    var error: String? = nil
    var mailboxes: [MailboxInfo]? = nil
    var messages: [MailMessage]? = nil
    var hasMore: Bool? = nil
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
let iso = ISO8601DateFormatter()
let isoFractional: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()

func launchMail(activates: Bool) {
    guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.mail") else { return }
    let semaphore = DispatchSemaphore(value: 0)
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = activates
    NSWorkspace.shared.openApplication(at: url, configuration: configuration) { _, _ in semaphore.signal() }
    _ = semaphore.wait(timeout: .now() + 5)
}

func emit(_ output: Output, exitCode: Int32 = 0) -> Never {
    do {
        let data = try encoder.encode(output)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    } catch {
        FileHandle.standardError.write(Data("mail helper encoding failed\n".utf8))
    }
    exit(exitCode)
}

func mailPermission(ask: Bool) -> OSStatus {
    let bundleId = "com.apple.mail"
    let bytes = Array(bundleId.utf8)
    var target = AEAddressDesc()
    let createStatus = bytes.withUnsafeBytes { buffer in
        AECreateDesc(
            DescType(typeApplicationBundleID),
            buffer.baseAddress,
            buffer.count,
            &target
        )
    }
    guard createStatus == noErr else { return OSStatus(createStatus) }
    defer { AEDisposeDesc(&target) }
    var status = AEDeterminePermissionToAutomateTarget(
        &target,
        AEEventClass(typeWildCard),
        AEEventID(typeWildCard),
        ask
    )
    if ask && status == procNotFound {
        launchMail(activates: true)
        status = AEDeterminePermissionToAutomateTarget(
            &target,
            AEEventClass(typeWildCard),
            AEEventID(typeWildCard),
            true
        )
    }
    return status
}

func authorizationName(_ status: OSStatus) -> String {
    if status == noErr { return "authorized" }
    if status == procNotFound { return "mailNotRunning" }
    if status == -1743 { return "notAuthorized" }
    if status == -1744 { return "notDetermined" }
    return "unknown"
}

func executeAppleScript(_ source: String) throws -> NSAppleEventDescriptor {
    var details: NSDictionary?
    guard let script = NSAppleScript(source: source) else {
        throw NSError(domain: "WeFlowMailHelper", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "Mail AppleScript could not be compiled"])
    }
    let result = script.executeAndReturnError(&details)
    if details != nil {
        let message = String(describing: details?["NSAppleScriptErrorMessage"] ?? "Mail AppleScript failed")
        throw NSError(domain: "WeFlowMailHelper", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
    return result
}

func scriptLiteral(_ value: String) -> String {
    return "\"" + value
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "\"", with: "\\\"") + "\""
}

func descriptorItems(_ descriptor: NSAppleEventDescriptor?) -> [NSAppleEventDescriptor] {
    guard let descriptor, descriptor.numberOfItems > 0 else { return [] }
    return (1...descriptor.numberOfItems).compactMap { descriptor.atIndex($0) }
}

func stringAt(_ descriptor: NSAppleEventDescriptor, _ index: Int) -> String {
    return descriptor.atIndex(index)?.stringValue ?? ""
}

func intAt(_ descriptor: NSAppleEventDescriptor, _ index: Int) -> Int {
    return Int(descriptor.atIndex(index)?.int32Value ?? 0)
}

func boolAt(_ descriptor: NSAppleEventDescriptor, _ index: Int) -> Bool {
    return descriptor.atIndex(index)?.booleanValue ?? false
}

func dateAt(_ descriptor: NSAppleEventDescriptor, _ index: Int) -> Date? {
    return descriptor.atIndex(index)?.dateValue
}

func encodeMailboxId(_ selector: MailboxSelector) -> String {
    guard let data = try? encoder.encode(selector) else { return "" }
    return data.base64EncodedString()
}

func decodeMailboxId(_ value: String) -> MailboxSelector? {
    guard let data = Data(base64Encoded: value) else { return nil }
    return try? JSONDecoder().decode(MailboxSelector.self, from: data)
}

func mailboxResolutionScript(_ selector: MailboxSelector) -> String {
    let components = selector.path.map(scriptLiteral).joined(separator: ",")
    return """
    set selectedAccountId to \(scriptLiteral(selector.accountId))
    set selectedPath to {\(components)}
    set selectedAccount to first account whose id is selectedAccountId
    set selectedContainer to selectedAccount
    repeat with pathPart in selectedPath
      set selectedContainer to first mailbox of selectedContainer whose name is (pathPart as text)
    end repeat
    """
}

func listMailboxes() throws -> [MailboxInfo] {
    let script = """
    on collectMailboxes(boxList, accountIdValue, accountNameValue, parentPath)
      set collected to {}
      repeat with boxItem in boxList
        set boxName to name of boxItem as text
        set boxPath to parentPath & {boxName}
        set end of collected to {accountIdValue, accountNameValue, boxPath}
        try
          set collected to collected & my collectMailboxes(mailboxes of boxItem, accountIdValue, accountNameValue, boxPath)
        end try
      end repeat
      return collected
    end collectMailboxes
    tell application "Mail"
      set collected to {}
      repeat with accountItem in every account
        if enabled of accountItem then
          set collected to collected & my collectMailboxes(mailboxes of accountItem, id of accountItem as text, name of accountItem as text, {})
        end if
      end repeat
      return collected
    end tell
    """
    return descriptorItems(try executeAppleScript(script)).compactMap { row in
        let accountId = stringAt(row, 1)
        let accountName = stringAt(row, 2)
        let path = descriptorItems(row.atIndex(3)).compactMap(\.stringValue)
        guard !accountId.isEmpty, !path.isEmpty else { return nil }
        let selector = MailboxSelector(accountId: accountId, accountName: accountName, path: path)
        return MailboxInfo(
            id: encodeMailboxId(selector),
            accountId: accountId,
            accountName: accountName,
            path: path,
            displayName: "\(accountName) / \(path.joined(separator: " / "))"
        )
    }
}

func listMessages(
    selector: MailboxSelector,
    mailboxId: String,
    start: Date,
    end: Date,
    limit: Int,
    skippedIds: Set<String>
) throws -> (messages: [MailMessage], hasMore: Bool) {
    let age = max(0, Date().timeIntervalSince(start))
    let metadataScript = """
    tell application "Mail"
      \(mailboxResolutionScript(selector))
      set cutoffDate to (current date) - \(Int(age))
      set foundMessages to every message of selectedContainer whose date received ≥ cutoffDate
      set metadataRows to {}
      set rowCount to 0
      repeat with messageItem in foundMessages
        set end of metadataRows to {id of messageItem as text, date received of messageItem}
        set rowCount to rowCount + 1
        if rowCount ≥ 100000 then exit repeat
      end repeat
      return metadataRows
    end tell
    """
    let candidates = descriptorItems(try executeAppleScript(metadataScript)).compactMap { row -> (String, Date)? in
        guard let date = dateAt(row, 2), date >= start, date <= end else { return nil }
        let id = stringAt(row, 1)
        return skippedIds.contains(id) ? nil : (id, date)
    }.sorted {
        if $0.1 == $1.1 { return $0.0 < $1.0 }
        return $0.1 < $1.1
    }
    let selected = Array(candidates.prefix(limit + 1))
    let ids = selected.prefix(limit).map(\.0)
    if ids.isEmpty { return ([], false) }
    let idLiterals = ids.map(scriptLiteral).joined(separator: ",")
    let detailScript = """
    tell application "Mail"
      \(mailboxResolutionScript(selector))
      set selectedIds to {\(idLiterals)}
      set detailRows to {}
      repeat with selectedId in selectedIds
        try
          set messageItem to first message of selectedContainer whose id is (selectedId as integer)
          set bodyText to content of messageItem as text
          if (length of bodyText) > 20000 then set bodyText to text 1 thru 20000 of bodyText
          set toAddresses to {}
          set ccAddresses to {}
          set attachmentNames to {}
          try
            set toAddresses to address of every to recipient of messageItem
          end try
          try
            set ccAddresses to address of every cc recipient of messageItem
          end try
          try
            set attachmentNames to name of every mail attachment of messageItem
          end try
          set end of detailRows to {id of messageItem as text, message id of messageItem as text, subject of messageItem as text, sender of messageItem as text, toAddresses, ccAddresses, date received of messageItem, date sent of messageItem, bodyText, read status of messageItem, flagged status of messageItem, message size of messageItem, attachmentNames}
        end try
      end repeat
      return detailRows
    end tell
    """
    let messages = descriptorItems(try executeAppleScript(detailScript)).compactMap { row -> MailMessage? in
        guard let received = dateAt(row, 7) else { return nil }
        let localId = stringAt(row, 1)
        return MailMessage(
            id: localId,
            messageId: stringAt(row, 2),
            accountId: selector.accountId,
            mailboxId: mailboxId,
            mailboxName: "\(selector.accountName) / \(selector.path.joined(separator: " / "))",
            subject: stringAt(row, 3),
            sender: stringAt(row, 4),
            to: descriptorItems(row.atIndex(5)).compactMap(\.stringValue),
            cc: descriptorItems(row.atIndex(6)).compactMap(\.stringValue),
            receivedAt: iso.string(from: received),
            sentAt: dateAt(row, 8).map { iso.string(from: $0) } ?? "",
            content: stringAt(row, 9),
            read: boolAt(row, 10),
            flagged: boolAt(row, 11),
            size: intAt(row, 12),
            attachmentNames: descriptorItems(row.atIndex(13)).compactMap(\.stringValue)
        )
    }
    return (messages, candidates.count > limit)
}

let arguments = CommandLine.arguments
guard arguments.count >= 2 else {
    emit(Output(success: false, error: "missing command"), exitCode: 2)
}
let command = arguments[1]

if command == "status" {
    emit(Output(success: true, authorization: authorizationName(mailPermission(ask: false))))
}

if command == "request" {
    let status = mailPermission(ask: true)
    emit(Output(success: status == noErr, authorization: authorizationName(status),
                error: status == noErr ? nil : "Mail automation access was not granted"),
         exitCode: status == noErr ? 0 : 3)
}

var readPermission = mailPermission(ask: false)
if readPermission == procNotFound {
    launchMail(activates: false)
    readPermission = mailPermission(ask: false)
}
guard readPermission == noErr else {
    emit(Output(success: false, authorization: authorizationName(readPermission),
                error: "Mail automation access is not authorized"), exitCode: 4)
}

do {
    if command == "mailboxes" {
        emit(Output(success: true, authorization: "authorized", mailboxes: try listMailboxes()))
    }
    if command == "messages" {
        guard arguments.count >= 7,
              let selector = decodeMailboxId(arguments[2]),
              let start = isoFractional.date(from: arguments[3]) ?? iso.date(from: arguments[3]),
              let end = isoFractional.date(from: arguments[4]) ?? iso.date(from: arguments[4]),
              let requestedLimit = Int(arguments[5]),
              let skippedData = arguments[6].data(using: .utf8),
              let skippedIds = try? JSONDecoder().decode([String].self, from: skippedData) else {
            emit(Output(success: false, authorization: "authorized", error: "invalid message arguments"), exitCode: 2)
        }
        let result = try listMessages(
            selector: selector,
            mailboxId: arguments[2],
            start: start,
            end: end,
            limit: max(1, min(500, requestedLimit)),
            skippedIds: Set(skippedIds)
        )
        emit(Output(success: true, authorization: "authorized", messages: result.messages, hasMore: result.hasMore))
    }
} catch {
    emit(Output(success: false, authorization: "authorized", error: error.localizedDescription), exitCode: 5)
}

emit(Output(success: false, authorization: "authorized", error: "unknown command"), exitCode: 2)
