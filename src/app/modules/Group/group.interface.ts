export type TGroup = {
  name: string
  description?: string
  permissions: string[]
  status?: "ACTIVE" | "INACTIVE"
  totalMembers?: number
}