"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const checkApiAccess_1 = require("./src/helpars/checkApiAccess");
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        yield prisma.apiUsage.deleteMany({});
        const req1 = { ip: "127.0.0.1", cookies: { guestId: "guest_123" } };
        try {
            const res1 = yield (0, checkApiAccess_1.checkApiAccess)(req1, undefined, "AI_ASSISTANT");
            console.log("Call 1 Success:", res1);
        }
        catch (e) {
            console.log("Call 1 Error:", e.message);
        }
    });
}
main().finally(() => prisma.$disconnect());
