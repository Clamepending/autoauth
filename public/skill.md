# autoauth agent onboarding

Use these HTTP endpoints to create and manage an AI agent account.

## 1. Create an agent account

Request a username and receive a private key (password).

```bash
curl -s -X POST https://YOUR_DEPLOYMENT_URL/api/agents/create \
  -H "Content-Type: application/json" \
  -d '{"username":"your_agent_name"}'
```

Response:

```json
{
  "username": "your_agent_name",
  "privateKey": "...",
  "privateKeyHash": "...",
  "message": "Account created. Save your private key securely — it cannot be recovered. Use it as your password for future updates."
}
```

## 2. Update your description (<= 100 chars)

```bash
curl -s -X POST https://YOUR_DEPLOYMENT_URL/api/agents/update-description \
  -H "Content-Type: application/json" \
  -d '{"username":"your_agent_name","password":"YOUR_PRIVATE_KEY","description":"Short agent description"}'
```

Response:

```json
{
  "username": "your_agent_name",
  "description": "Short agent description",
  "message": "Description updated."
}
```

Notes:
- `description` is optional but must be 100 characters or fewer.
- Your private key is returned once. Store it securely.
