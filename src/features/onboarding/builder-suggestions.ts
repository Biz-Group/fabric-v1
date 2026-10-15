// Name suggestions for the Getting started builder. Static on purpose: they
// only need to show what a function, department or process looks like, so a
// new admin isn't staring at an empty field.

export const FUNCTION_SUGGESTIONS = [
  "Finance",
  "Operations",
  "Human Resources",
  "Sales",
  "Technology",
  "Legal & Compliance",
  "Marketing",
  "Procurement",
];

const DEPARTMENTS_BY_FUNCTION: Record<string, string[]> = {
  finance: ["Accounts Payable", "Accounts Receivable", "Payroll", "Financial Planning", "Treasury"],
  operations: ["Customer Service", "Logistics", "Facilities", "Quality Assurance"],
  "human resources": ["Recruitment", "Onboarding", "Learning & Development", "Employee Relations"],
  people: ["Recruitment", "Onboarding", "Learning & Development", "Employee Relations"],
  sales: ["Business Development", "Account Management", "Sales Operations"],
  technology: ["IT Support", "Infrastructure", "Software Development", "Information Security"],
  it: ["IT Support", "Infrastructure", "Information Security"],
  "legal compliance": ["Contracts", "Regulatory Compliance", "Corporate Governance"],
  legal: ["Contracts", "Regulatory Compliance", "Corporate Governance"],
  marketing: ["Brand", "Digital Marketing", "Communications", "Events"],
  procurement: ["Purchasing", "Vendor Management", "Contracts"],
};

const PROCESSES_BY_DEPARTMENT: Record<string, string[]> = {
  "accounts payable": ["Invoice approval", "Vendor payments", "Expense claims"],
  "accounts receivable": ["Customer invoicing", "Collections", "Cash application"],
  payroll: ["Monthly payroll run", "New starter setup", "End-of-service settlement"],
  "financial planning": ["Annual budgeting", "Monthly forecast", "Variance reporting"],
  treasury: ["Cash forecasting", "Bank reconciliation"],
  "customer service": ["Complaint handling", "Order enquiries", "Returns and refunds"],
  logistics: ["Shipment booking", "Goods receiving", "Delivery scheduling"],
  facilities: ["Maintenance requests", "Office moves", "Access cards"],
  "quality assurance": ["Inspection", "Non-conformance handling", "Audit preparation"],
  recruitment: ["Job requisition", "Candidate screening", "Offer approval"],
  onboarding: ["New joiner setup", "Probation review"],
  "learning development": ["Training requests", "Course enrolment"],
  "employee relations": ["Grievance handling", "Disciplinary process"],
  "business development": ["Lead qualification", "Proposal preparation"],
  "account management": ["Contract renewal", "Quarterly business review"],
  "sales operations": ["Quote approval", "Commission calculation"],
  "it support": ["Password reset", "Laptop provisioning", "Incident handling"],
  infrastructure: ["Server patching", "Backup and restore"],
  "software development": ["Release deployment", "Bug triage"],
  "information security": ["Access review", "Security incident response"],
  contracts: ["Contract review", "Contract signature"],
  "regulatory compliance": ["Regulatory filing", "Policy attestation"],
  purchasing: ["Purchase requisition", "Purchase order approval"],
  "vendor management": ["Vendor onboarding", "Vendor evaluation"],
  "digital marketing": ["Campaign launch", "Social media posting"],
  communications: ["Press release approval", "Internal newsletter"],
};

/** Lower-case, "&" read as "and", "and" and punctuation dropped, so "Legal &
 * Compliance", "legal and compliance" and "Legal/Compliance" all match. */
export function normalizeName(name: string) {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word && word !== "and")
    .join(" ");
}

/** Suggestions minus names already used by a sibling, compared case- and
 * punctuation-insensitively. */
function withoutSiblings(suggestions: string[], siblingNames: string[]) {
  const taken = new Set(siblingNames.map(normalizeName));
  return suggestions.filter((name) => !taken.has(normalizeName(name)));
}

export function suggestFunctions(existingNames: string[]) {
  return withoutSiblings(FUNCTION_SUGGESTIONS, existingNames);
}

/** Departments for a known function; none for one we don't recognise. */
export function suggestDepartments(functionName: string, siblingNames: string[]) {
  return withoutSiblings(
    DEPARTMENTS_BY_FUNCTION[normalizeName(functionName)] ?? [],
    siblingNames,
  );
}

/** Processes for a known department; none for one we don't recognise. */
export function suggestProcesses(departmentName: string, siblingNames: string[]) {
  return withoutSiblings(
    PROCESSES_BY_DEPARTMENT[normalizeName(departmentName)] ?? [],
    siblingNames,
  );
}
