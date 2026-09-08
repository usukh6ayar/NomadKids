import type { EsisRequest } from "./esis.types";
import { sampleRows, type EsisEndpointKey } from "./esis.samples";
import institution from "./fixtures/institution.json";
import group from "./fixtures/group.json";
import teacher from "./fixtures/teacher.json";
import student from "./fixtures/student.json";
import enrollment from "./fixtures/enrollment.json";
import attendance from "./fixtures/attendance.json";
import progression from "./fixtures/progression.json";

const CORE_FIXTURES: Partial<Record<EsisEndpointKey, unknown>> = {
  organization: institution,
  groups: group,
  teachers: teacher,
  students: student,
  groupStudents: enrollment,
  groupAttendance: attendance,
  studentMovements: progression,
};

/**
 * Deterministic ESIS demo responses.
 *
 * Each read uses the documented ESIS envelope and the same field keys/types
 * accepted by the live parser. The records are fictional and contain no civil
 * registration number, provider password, or other refused personal field.
 * `studentMovements` is the enrollment/progression fixture; `groupAttendance`
 * and `saveAttendanceV3` cover attendance read and write respectively.
 */
export function esisDemoFixture(key: EsisEndpointKey, request: Pick<EsisRequest, "body">): unknown {
  if (key === "saveAttendanceV3") {
    const attendanceCount =
      typeof request.body === "object" &&
      request.body !== null &&
      "attendanceList" in request.body &&
      Array.isArray(request.body.attendanceList)
        ? request.body.attendanceList.length
        : 0;

    return {
      SUCCESS_CODE: 200,
      RESPONSE_MESSAGE: "DEMO_SUCCESS",
      RESULT: {
        status: "MOCK",
        accepted: true,
        acceptedCount: attendanceCount,
        referenceId: "MOCK-ATTENDANCE-20260908-001",
      },
    };
  }

  const fixture = CORE_FIXTURES[key];
  if (fixture) return fixture;

  return {
    SUCCESS_CODE: 200,
    RESPONSE_MESSAGE: "DEMO_SUCCESS",
    RESULT: sampleRows(key),
  };
}
