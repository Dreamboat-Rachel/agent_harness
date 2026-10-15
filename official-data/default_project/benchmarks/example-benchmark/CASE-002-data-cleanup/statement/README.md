# Task: Clean up a CSV dataset

The workspace contains `users.csv` with duplicate rows and inconsistent casing in the email column.
Produce `users_clean.csv` where:
1. Emails are lowercased and rows with an empty email are removed.
2. Exact duplicate rows are dropped, keeping the first occurrence.
Do not change the column order.
