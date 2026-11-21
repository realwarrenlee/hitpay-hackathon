import { StatusFeedback } from "@/components/status-feedback";
import Link from "next/link";
import { CheckIcon, ArrowRightIcon, ShieldCheckIcon } from "lucide-react";
import { Shell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { ImportUpload } from "@/components/import-upload";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
export const dynamic = "force-dynamic";
export const metadata = { title: "Import" };
export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  return (
    <Shell>
      <PageHeader
        title="Import transactions"
        description="Bring your DBS bank credits into Tally, ready for review."
      />
      <StatusFeedback status={params.status} />
      <div className="grid min-w-0 items-stretch gap-6 xl:grid-cols-12">
        <Card className="xl:col-span-8">
          <CardHeader>
            <CardTitle>Upload bank statement</CardTitle>
            <CardDescription>
              Accepted format: original DBS CSV export.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col">
            <ImportUpload />
          </CardContent>
        </Card>
        <div className="flex flex-col gap-6 xl:col-span-4">
          <Card>
            <CardHeader>
              <CardTitle>Before you import</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-5">
                {[
                  "Only credits enter review; debits are excluded",
                  "Duplicate imports add no new records",
                ].map((text) => (
                  <li
                    key={text}
                    className="flex gap-3 text-sm leading-6 text-muted-foreground"
                  >
                    <CheckIcon className="mt-1 size-4 shrink-0" />
                    {text}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card className="flex-1">
            <CardHeader>
              <ShieldCheckIcon className="mb-2 size-5 text-muted-foreground" />
              <CardTitle>You stay in control</CardTitle>
              <CardDescription>
                Importing never approves a bank match. Review the suggested
                allocations before confirming them.
              </CardDescription>
            </CardHeader>
            <CardContent className="mt-auto">
              <Link
                href="/review"
                className="flex items-center justify-between text-sm font-medium hover:underline"
              >
                Go to review
                <ArrowRightIcon className="size-4" />
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </Shell>
  );
}
