# Database security tests

Each `*.test.sql` file is one `DO` block that builds throwaway users and workspaces,
impersonates them the way the API does, and ends by raising an exception that carries
the report, for example `TENANCY TESTS: 52 passed, 0 failed`. Raising rolls everything
back, so the database is untouched.

Run a file against the project with any SQL client connected as `postgres`
(Supabase dashboard > SQL editor works). A run is green when the message says `0 failed`.

A table is not finished until its checks are in one of these files and pass.
