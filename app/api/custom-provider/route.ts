import { customProviderGet, customProviderMutation } from "@/src/server";

export const dynamic = "force-dynamic";
export const GET = customProviderGet;
export const POST = customProviderMutation;
export const PATCH = customProviderMutation;
export const DELETE = customProviderMutation;
