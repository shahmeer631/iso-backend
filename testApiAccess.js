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
        // mock req
        const req1 = { ip: "127.0.0.1", cookies: {} };
        try {
            const res1 = yield (0, checkApiAccess_1.checkApiAccess)(req1, undefined, "AI_ASSISTANT");
            console.log("Call 1 Success:", res1);
        }
        catch (e) {
            console.log("Call 1 Error:", e.message);
        }
        const req2 = { ip: "127.0.0.1", cookies: {} };
        try {
            const res2 = yield (0, checkApiAccess_1.checkApiAccess)(req2, undefined, "AI_ASSISTANT");
            console.log("Call 2 Success:", res2);
        }
        catch (e) {
            console.log("Call 2 Error:", e.message);
        }
        const req3 = { ip: "127.0.0.1", cookies: {} };
        try {
            const res3 = yield (0, checkApiAccess_1.checkApiAccess)(req3, undefined, "AI_ASSISTANT");
            console.log("Call 3 Success:", res3);
        }
        catch (e) {
            console.log("Call 3 Error:", e.message);
        }
        const req4 = { ip: "127.0.0.1", cookies: {} };
        try {
            const res4 = yield (0, checkApiAccess_1.checkApiAccess)(req4, undefined, "AI_ASSISTANT");
            console.log("Call 4 Success:", res4);
        }
        catch (e) {
            console.log("Call 4 Error:", e.message);
        }
    });
}
main().finally(() => prisma.$disconnect());
