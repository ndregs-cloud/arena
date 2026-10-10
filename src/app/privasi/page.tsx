import type { Metadata } from "next";
import { PolicyPage } from "@/components/commerce/policy-page";

export const metadata: Metadata = {
  title: "Kebijakan Privasi",
  alternates: { canonical: "/privasi" },
};

export default function PrivacyPolicyPage() {
  return <PolicyPage policyKey="privasi" />;
}
