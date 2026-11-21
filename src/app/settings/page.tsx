import { Shell } from "@/components/shell";
import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/settings-form";
import { readEnv } from "@/server/env";
import { currentPolicy } from "@/server/policy";
import { localPolicyAccess } from "@/server/local-policy-access";
export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };
export default function SettingsPage() {
  const env = readEnv();
  return (
    <Shell>
      <PageHeader
        title="Settings"
        description="The policies that guide reconciliation and delivery decisions."
      />
      <SettingsForm
        initial={currentPolicy()}
        editable={localPolicyAccess()}
        autoApprove={env.autoApproveRemainder}
      />
    </Shell>
  );
}
