import slugify from "slugify";
import { Category } from "@prisma/client";
import prisma from "../../../shared/prisma";

const createCategory = async (payload: Category) => {
  const slug = slugify(payload.name, { lower: true });

  const result = await prisma.category.create({
    data: {
      name: payload.name,
      slug,
      description: payload.description,
      courseDesc: payload.courseDesc,
      standardDesc: payload.standardDesc,
      standardSub: payload.standardSub,
      order: payload.order,
    },
  });

  return result;
};

const getCategories = async () => {
  const result = await prisma.category.findMany({
    orderBy: {
      order: "asc",
    },
  });

  return result;
};

const updateCategory = async (id: string, payload: Category) => {
  const data = { ...payload };

  if (payload.name) {
    data.slug = slugify(payload.name, {
      lower: true,
    });
  }

  const result = await prisma.category.update({
    where: { id },
    data,
  });

  return result;
};

const deleteCategory = async (id: string) => {
  const result = await prisma.category.delete({
    where: { id },
  });

  return result;
};

export const CategoryService = {
  createCategory,
  getCategories,
  updateCategory,
  deleteCategory,
};
