/** The path values a service can ask for, in the operator's language. */
export const ESIS_PARAM_LABEL: Record<string, string> = {
  studentGroupId: "ESIS бүлгийн дугаар",
  productId: "ESIS бүтээгдэхүүний дугаар",
  personRegNumber: "РД (регистрийн дугаар)",
  dayDate: "Огноо",
  beginDate: "Эхлэх огноо",
};

/**
 * What a demo deployment fills a required parameter with.
 *
 * ★ `personRegNumber` is deliberately absent. Every other value here is an
 * ESIS id from the demo tenant; a register number is a real person's national
 * identifier and there is no such thing as a safe invented one to pre-fill a
 * form with. The authorised staff member types it, or the search does not run.
 */
export const ESIS_DEMO_PARAM: Record<string, string> = {
  studentGroupId: "10001",
  productId: "51001",
  dayDate: "2026-09-08",
  beginDate: "2026-09-01",
};

/** Whether a parameter is a personal identifier rather than an ESIS id. */
export const isPersonalParam = (name: string) => name === "personRegNumber";

/**
 * How a service's portal id reads on screen.
 *
 * ★ A null is a service whose catalog entry has not been read yet, and it says
 * so. Rendering "ID null" or hiding the line would both let an unfinished
 * scope request look finished — access is granted per id, so the id is the one
 * thing an operator cannot supply from our side.
 */
export const esisApiIdLabel = (apiId: number | null) =>
  apiId === null ? "ID тодруулах" : `ID ${apiId}`;
