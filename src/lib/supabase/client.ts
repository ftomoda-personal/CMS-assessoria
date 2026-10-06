import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./config";

// Add the generated Database generic here when database types are introduced.
export const supabase = createClient(supabaseConfig.url, supabaseConfig.publishableKey);
