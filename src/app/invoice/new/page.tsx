import { RecordEntryPage } from "@/components/record-entry-page";
export const dynamic = "force-dynamic";
export const metadata = { title: "New invoice" };
export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  return (
    <RecordEntryPage
      kind="invoice"
      customerId={(await searchParams).customerId}
    />
  );
}
