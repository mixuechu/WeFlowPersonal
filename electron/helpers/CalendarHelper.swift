import EventKit
import Foundation

struct Output: Encodable {
    let success: Bool
    var authorization: String? = nil
    var error: String? = nil
    var calendars: [[String: String]]? = nil
    var events: [CalendarEvent]? = nil
}

struct CalendarParticipant: Encodable {
    let name: String
    let email: String
    let role: String
    let status: String
}

struct CalendarEvent: Encodable {
    let id: String
    let externalId: String
    let calendarId: String
    let calendarTitle: String
    let title: String
    let notes: String
    let location: String
    let url: String
    let startAt: String
    let endAt: String
    let isAllDay: Bool
    let status: String
    let organizer: CalendarParticipant?
    let attendees: [CalendarParticipant]
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
let iso = ISO8601DateFormatter()
let isoWithFractionalSeconds: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()

func parseISODate(_ value: String) -> Date? {
    return isoWithFractionalSeconds.date(from: value) ?? iso.date(from: value)
}

func emit(_ output: Output, exitCode: Int32 = 0) -> Never {
    do {
        let data = try encoder.encode(output)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    } catch {
        FileHandle.standardError.write(Data("calendar helper encoding failed\n".utf8))
    }
    exit(exitCode)
}

func authorizationName() -> String {
    let status = EKEventStore.authorizationStatus(for: .event)
    if #available(macOS 14.0, *) {
        switch status {
        case .fullAccess: return "fullAccess"
        case .writeOnly: return "writeOnly"
        case .notDetermined: return "notDetermined"
        case .restricted: return "restricted"
        case .denied: return "denied"
        @unknown default: return "unknown"
        }
    } else {
        switch status {
        case .authorized: return "authorized"
        case .notDetermined: return "notDetermined"
        case .restricted: return "restricted"
        case .denied: return "denied"
        case .fullAccess: return "fullAccess"
        case .writeOnly: return "writeOnly"
        @unknown default: return "unknown"
        }
    }
}

func hasReadAccess() -> Bool {
    let value = authorizationName()
    return value == "fullAccess" || value == "authorized"
}

func participant(_ value: EKParticipant) -> CalendarParticipant {
    let email = value.url.absoluteString.replacingOccurrences(of: "mailto:", with: "")
    let role: String
    switch value.participantRole {
    case .chair: role = "chair"
    case .required: role = "required"
    case .optional: role = "optional"
    case .nonParticipant: role = "nonParticipant"
    default: role = "unknown"
    }
    let status: String
    switch value.participantStatus {
    case .accepted: status = "accepted"
    case .declined: status = "declined"
    case .tentative: status = "tentative"
    case .delegated: status = "delegated"
    case .completed: status = "completed"
    case .inProcess: status = "inProcess"
    case .pending: status = "pending"
    default: status = "unknown"
    }
    return CalendarParticipant(name: value.name ?? "", email: email, role: role, status: status)
}

let arguments = CommandLine.arguments
guard arguments.count >= 2 else {
    emit(Output(success: false, error: "missing command"), exitCode: 2)
}
let command = arguments[1]
let store = EKEventStore()

if command == "status" {
    emit(Output(success: true, authorization: authorizationName()))
}

if command == "request" {
    let semaphore = DispatchSemaphore(value: 0)
    var requestError: Error?
    if #available(macOS 14.0, *) {
        store.requestFullAccessToEvents { _, error in
            requestError = error
            semaphore.signal()
        }
    } else {
        store.requestAccess(to: .event) { _, error in
            requestError = error
            semaphore.signal()
        }
    }
    if semaphore.wait(timeout: .now() + 60) == .timedOut {
        emit(Output(success: false, authorization: authorizationName(), error: "authorization timed out"), exitCode: 3)
    }
    if let error = requestError {
        emit(Output(success: false, authorization: authorizationName(), error: error.localizedDescription), exitCode: 3)
    }
    emit(Output(success: hasReadAccess(), authorization: authorizationName()))
}

guard hasReadAccess() else {
    emit(Output(success: false, authorization: authorizationName(), error: "calendar access is not authorized"), exitCode: 4)
}

if command == "calendars" {
    let calendars = store.calendars(for: .event).map {
        [
            "id": $0.calendarIdentifier,
            "title": $0.title,
            "source": $0.source.title,
            "type": String($0.type.rawValue)
        ]
    }
    emit(Output(success: true, authorization: authorizationName(), calendars: calendars))
}

if command == "events" {
    guard arguments.count >= 4,
          let start = parseISODate(arguments[2]),
          let end = parseISODate(arguments[3]) else {
        emit(Output(success: false, authorization: authorizationName(), error: "invalid event date range"), exitCode: 2)
    }
    let selectedIds: Set<String>
    if arguments.count >= 5,
       let data = arguments[4].data(using: .utf8),
       let decoded = try? JSONDecoder().decode([String].self, from: data) {
        selectedIds = Set(decoded)
    } else {
        selectedIds = []
    }
    let calendars = store.calendars(for: .event).filter {
        selectedIds.isEmpty || selectedIds.contains($0.calendarIdentifier)
    }
    let predicate = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
    let events = store.events(matching: predicate).prefix(10000).map { event in
        CalendarEvent(
            id: event.eventIdentifier ?? "",
            externalId: event.calendarItemExternalIdentifier,
            calendarId: event.calendar.calendarIdentifier,
            calendarTitle: event.calendar.title,
            title: event.title ?? "",
            notes: event.notes ?? "",
            location: event.location ?? "",
            url: event.url?.absoluteString ?? "",
            startAt: iso.string(from: event.startDate),
            endAt: iso.string(from: event.endDate),
            isAllDay: event.isAllDay,
            status: String(event.status.rawValue),
            organizer: event.organizer.map(participant),
            attendees: (event.attendees ?? []).map(participant)
        )
    }
    emit(Output(success: true, authorization: authorizationName(), events: Array(events)))
}

emit(Output(success: false, authorization: authorizationName(), error: "unknown command"), exitCode: 2)
