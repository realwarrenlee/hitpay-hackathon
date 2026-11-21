import { RecordEntryPage } from "@/components/record-entry-page";
export const dynamic = "force-dynamic";
export const metadata = { title: "New delivery" };
export default async function NewDeliveryPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  return (
    <RecordEntryPage
      kind="delivery"
      customerId={(await searchParams).customerId}
    />
  );
}
