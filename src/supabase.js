import { createClient } from "@supabase/supabase-js";
const SUPABASE_URL = "https://fxszzeqbkzsyoenycjqr.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4c3p6ZXFia3pzeW9lbnljanFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MTYyNDQsImV4cCI6MjA5NTE5MjI0NH0.se631aqIdcpiTrDJsW8dfArqYFfebqH9YdIs5H1R2h8";
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
