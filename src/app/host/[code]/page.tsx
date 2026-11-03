"use client";

import { useParams } from "next/navigation";
import { HostControls } from "@/components/host/HostControls";

export default function HostPage() {
  const { code } = useParams<{ code: string }>();
  return <HostControls code={code.toUpperCase()} />;
}
