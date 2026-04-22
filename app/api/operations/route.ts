import { NextResponse } from "next/server"
import { getOperationsLiveData } from "@/lib/operations-live-data"

export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json(await getOperationsLiveData())
}
