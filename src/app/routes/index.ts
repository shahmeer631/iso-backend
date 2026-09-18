import express from "express";
import { UserRoutes } from "../modules/User/user.route";
import { AuthRoutes } from "../modules/Auth/auth.routes";
import { OTPRoutes } from "../modules/OTP/otp.routes";
import { CategoryRoutes } from "../modules/category/category.route";
import { CourseRoutes } from "../modules/courses/course.route";
import { UploadRoutes } from "../modules/Upload/upload.routes";
import { ISOStandardRoutes } from "../modules/ISOStandard/isoStandard.route";
import { BundleRoutes } from "../modules/Bundle/bundle.route";
import { VideoRoutes } from "../modules/Video/video.route";
import { DocumentRoutes } from "../modules/Document/document.routes";
import { GroupRoutes } from "../modules/Group/group.route";
import { AIAssistantRoutes } from "../modules/AIAssistant/aiassistant.route";
import { CourseNoteRoutes } from "../modules/courses/notes/courseNote.route";
import { LessonRoutes } from "../modules/Lesson/lesson.route";
import { QuizRoutes } from "../modules/Quiz/quiz.route";
import { PlanRoutes } from "../modules/Plan/plan.routes";
import { CouponRoutes } from "../modules/Coupon/coupon.routes";
import { PaymentRoutes } from "../modules/Payment/payment.routes";
import { CommunityRoutes } from "../modules/Community/community.route";
import { AffiliateRoutes } from "../modules/Affiliate/affiliate.route";
import { ProgressRoutes } from "../modules/Progress/progress.route";
import { DashboardRoutes } from "../modules/adminDashboard/dashboard.route";
import { ReviewRoutes } from "../modules/Review/review.route";
import { UserDashboardRoutes } from "../modules/UserDashboard/dashboard.route";
import { CertificateRoutes } from "../modules/Certificate/certificate.route";
import { MasteryLabRoute } from "../modules/MasteryLab/masteryLab.route";

const router = express.Router();

const moduleRoutes = [
  {
    path: "/users",
    route: UserRoutes,
  },
  {
    path: "/auth",
    route: AuthRoutes,
  },
  {
    path: "/uploads",
    route: UploadRoutes,
  },
  {
    path: "/otp",
    route: OTPRoutes,
  },
  {
    path: "/categories",
    route: CategoryRoutes,
  },
  {
    path: "/courses",
    route: CourseRoutes,
  },
  {
    path: "/iso-standards",
    route: ISOStandardRoutes,
  },
  {
    path: "/bundles",
    route: BundleRoutes,
  },
  {
    path: "/videos",
    route: VideoRoutes,
  },
  {
    path: "/documents",
    route: DocumentRoutes,
  },
  {
    path: "/groups",
    route: GroupRoutes,
  },
  {
    path: "/ai-assistant",
    route: AIAssistantRoutes,
  },
  {
    path: "/notes",
    route: CourseNoteRoutes,
  },
  {
    path: "/lessons",
    route: LessonRoutes,
  },
  {
    path: "/quiz",
    route: QuizRoutes,
  },
  {
    path: "/plans",
    route: PlanRoutes,
  },
  {
    path: "/coupons",
    route: CouponRoutes,
  },
  {
    path: "/payments",
    route: PaymentRoutes,
  },
  {
    path: "/communities",
    route: CommunityRoutes,
  },
  {
    path: "/affiliates",
    route: AffiliateRoutes,
  },
  {
    path: "/progress",
    route: ProgressRoutes,
  },
  {
    path: "/dashboard",
    route: DashboardRoutes,
  },
  {
    path: "/reviews",
    route: ReviewRoutes,
  },
  {
    path: "/user-dashboard",
    route: UserDashboardRoutes,
  },
  {
    path: "/certificates",
    route: CertificateRoutes,
  },
  {
    path: "/mastery-labs",
    route: MasteryLabRoute,
  },
];


moduleRoutes.forEach((route) => router.use(route.path, route.route));

export default router;
