import Joi from 'joi';

export const signupStep1Schema = Joi.object({
  email: Joi.string().email().required(),
  phone: Joi.string().required(),
  password: Joi.string().min(6).required(),
});

export const otpSchema = Joi.object({
  email: Joi.string().email().required(),
  otp: Joi.string().length(6).required(),
});

export const signupStep2Schema = Joi.object({
  email: Joi.string().email().required(),
  governmentIdUrl: Joi.string().required(),
});

export const signupStep3Schema = Joi.object({
  email: Joi.string().email().required(),
  cardType: Joi.string().valid('virtual', 'physical').required(),
  address: Joi.when('cardType', {
    is: 'physical',
    then: Joi.object({
      address: Joi.string().required(),
      apartment: Joi.string().allow(''),
      city: Joi.string().required(),
      state: Joi.string().required(),
      zip: Joi.string().required(),
    }).required(),
    otherwise: Joi.forbidden(),
  }),
});

export const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

export const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required(),
});

export const resetPasswordSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  token: Joi.string().required(),
});
