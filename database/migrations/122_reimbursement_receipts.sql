-- A reimbursement claim carries its receipt (bill, ticket, invoice). The API requires one
-- on every new claim; claims recorded before this change keep none. The file is stored as
-- one of the employee's documents (category "Claim receipt") and opened through the
-- claim's own finance route.
ALTER TABLE reimbursements ADD COLUMN receipt_document_id uuid REFERENCES documents(id) ON DELETE SET NULL;
