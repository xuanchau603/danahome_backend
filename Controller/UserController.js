const {
  RoleModel,
  UserModel,
  VerifyCodeModel,
  NewsModel,
} = require("../Model");
const { Op } = require("sequelize");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cloudinary = require("cloudinary").v2;
const moment = require("moment");

const UserController = {
  getAllUser: async (req, res) => {
    const page = req.query.page || 1;
    try {
      const users = await UserModel.findAll({
        include: [
          {
            model: RoleModel,
            attributes: ["role_Name"],
          },
          {
            model: NewsModel,
          },
        ],
        where: {
          [Op.and]: [
            {
              type: req.query.type
                ? req.query.type
                : {
                    [Op.ne]: null,
                  },
            },
            {
              role_Id: req.query.roleId
                ? req.query.roleId
                : {
                    [Op.ne]: null,
                  },
            },
          ],
        },
        offset: (page - 1) * 5,
        limit: 5,
      });

      const newData = users.map((item) => {
        const { password, role, news, ...data } = item.dataValues;
        if (moment() >= moment(item.dataValues.VIP_Expire_At)) {
          if (item.dataValues.type === 1) {
            const updateStatus = async () => {
              await UserModel.update(
                {
                  type: 2,
                },
                {
                  where: {
                    ID: item.dataValues.ID,
                  },
                },
              );
            };
            updateStatus();
          }
        }
        return {
          ...data,
          role_Name: item.dataValues.role.role_Name,
          total_News: item.dataValues.news.length,
        };
      });
      const totalUser = await UserModel.count({
        where: {
          [Op.and]: [
            {
              type: req.query.type
                ? req.query.type
                : {
                    [Op.ne]: null,
                  },
            },
            {
              role_Id: req.query.roleId
                ? req.query.roleId
                : {
                    [Op.ne]: null,
                  },
            },
          ],
        },
      });

      res.status(200).json({
        message: "Thành công",
        data: newData,
        totalUser,
      });
    } catch (error) {
      res.status(500).json({
        message: "Lỗi server",
        error,
      });
    }
  },
  getUserById: async (req, res) => {
    const userId = req.params.id;
    if (userId) {
      try {
        const user = await UserModel.findByPk(userId, {
          include: {
            model: RoleModel,
          },
        });
        const { role, password, role_Id, ...data } = user.dataValues;

        res.status(200).json({
          message: "Thành công",
          user_Info: { ...data, isAdmin: user.role.role_Name === "ADMIN" },
        });
      } catch (error) {
        res.status(404).json({
          message: "Tài khoản không tồn tại!",
          error,
        });
      }
    } else {
      res.status(403).json({
        message: "Dữ liệu gửi lên không hợp lệ",
      });
    }
  },
  loginUser: async (req, res) => {
    const email = req.body.email;
    const password = req.body.password;
    //Check exist email
    try {
      const user = await UserModel.findOne({
        where: {
          email: email,
        },
        include: {
          model: RoleModel,
        },
      });
      if (user.dataValues.type === 3) {
        return res.status(403).json({
          message:
            "Tài khoản của bạn đã bị khóa! Liên hệ quản trị viên để được mở khóa tài khoản.",
        });
      }

      const validPassword = await bcrypt.compare(
        password,
        user.dataValues.password,
      );

      if (validPassword) {
        const accaccess_Token = jwt.sign(
          {
            id: user.dataValues.ID,
            isAdmin: user.role.role_Name === "ADMIN",
          },
          "0802",
          {
            expiresIn: "3d",
          },
        );
        const { role, password, role_Id, ...data } = user.dataValues;

        res.status(200).json({
          message: "Đăng nhập thành công",
          user_Info: { ...data, isAdmin: user.role.role_Name === "ADMIN" },
          access_Token: accaccess_Token,
        });
      } else {
        res.status(401).json({
          message: "Mật khẩu không đúng",
        });
      }
    } catch (error) {
      res.status(404).json({
        message: "Email không tồn tại",
      });
    }
  },
  registerUser: async (req, res) => {
    const fullName = req.body.fullName;
    const email = req.body.email;
    const phone = req.body.phone;
    const password = req.body.password;
    const code = req.body.code;

    if (!fullName || !email || !phone || !password) {
      res.status(401).json({
        message: "Dữ liệu gửi đi không hợp lệ!",
      });
    } else {
      //check exist user
      const user = await UserModel.findOne({
        where: {
          phone: phone,
        },
      });

      if (user) {
        res.status(401).json({
          message: "Số điện thoại đã đăng ký",
        });
      } else {
        const valid = await VerifyCodeModel.findOne({
          where: {
            [Op.and]: [{ email: email }, { code: code }],
          },
        });
        if (valid) {
          try {
            const salt = await bcrypt.genSalt(10);
            const passwordHashed = await bcrypt.hash(password, salt);
            await UserModel.create({
              full_Name: fullName,
              email: email,
              phone: phone,
              password: passwordHashed,
            });
            res.status(200).json({
              message: "Đăng ký tài khoản thành công",
            });
          } catch (error) {
            res.status(500).json({
              message: "Lỗi server!",
              error,
            });
          }
        } else {
          res.status(401).json({
            message: "Mã xác nhận không đúng",
          });
        }
      }
    }
  },
  editUser: async (req, res) => {
    const userId = req.body.userId || req.user.id;
    const email = req.body.email;
    const fullName = req.body.fullName;
    const phone = req.body.phone;
    const type = req.body.type;
    const amount = req.body.amount;
    const roleId = req.body.roleId;
    const VIP_Expire_At = req.body.VIP_Expire_At;
    const user = await UserModel.findByPk(userId);
    try {
      if (userId === user.dataValues.ID || req.user.isAdmin) {
        if (
          req.file &&
          !user.dataValues.image_URL ===
            "https://res.cloudinary.com/di5qmcigy/image/upload/v1682486641/avatar_user/a_m4jkyd.png"
        ) {
          const path = `${
            user.dataValues.image_URL
              .split("https://res.cloudinary.com/di5qmcigy/image/upload/")[1]
              .split(".")[0]
              .split("/")[1]
          }/${
            user.dataValues.image_URL
              .split("https://res.cloudinary.com/di5qmcigy/image/upload/")[1]
              .split(".")[0]
              .split("/")[2]
          }`;
          cloudinary.api.delete_resources(path, function (error, result) {
            if (error) {
              return res.status(501).json({
                message: error,
              });
            }
          });
        }

        await UserModel.update(
          {
            email: email || user.dataValues.email,
            full_Name: fullName || user.dataValues.full_Name,
            phone: phone || user.dataValues.phone,
            image_URL: !req.file ? user.dataValues.image_URL : req.file.path,
            type: type || user.dataValues.type,
            amount: amount || user.dataValues.amount,
            role_Id: roleId || user.dataValues.roleId,
            VIP_Expire_At: VIP_Expire_At || user.dataValues.VIP_Expire_At,
          },
          {
            where: {
              ID: userId,
            },
          },
        );
        res.status(200).json({
          message: "Cập nhật thông tin tài khoản thành công",
        });
      } else {
        res.status(401).json({
          message: "Bạn không có quyền sửa thông tin tài khoản này!",
        });
      }
    } catch (error) {
      if (req.file) {
        const path = req.file.filename;
        cloudinary.api.delete_resources(path, function (error, result) {
          if (error) {
            return res.status(501).json({
              message: error,
            });
          }
        });
      }
      res.status(500).json({
        message: "Lỗi server",
      });
    }
  },
  resetPassword: async (req, res) => {
    const userId = req.body.userId;
    const password = req.body.password;
    const newPassword = req.body.newPassword;

    try {
      const user = await UserModel.findByPk(userId);
      if (req.user.isAdmin) {
        const salt = await bcrypt.genSalt(10);
        const passwordHashed = await bcrypt.hash(newPassword, salt);
        await UserModel.update(
          {
            password: passwordHashed,
          },
          {
            where: {
              ID: userId,
            },
          },
        );
        return res.status(200).json({
          message: "Cập nhật mật khẩu thành công!",
        });
      } else if (user.dataValues.ID === req.user.id) {
        const validPassword = await bcrypt.compare(
          password,
          user.dataValues.password,
        );
        if (validPassword) {
          const salt = await bcrypt.genSalt(10);
          const passwordHashed = await bcrypt.hash(newPassword, salt);
          await UserModel.update(
            {
              password: passwordHashed,
            },
            {
              where: {
                ID: userId,
              },
            },
          );
          res.status(200).json({
            message: "Cập nhật mật khẩu thành công!",
          });
        } else {
          res.status(403).json({
            message: "Mật khẩu cũ không đúng!",
          });
        }
      } else {
        res.status(403).json({
          message: "Bạn không có quyền thay đổi mật khẩu tài khoản này!",
        });
      }
    } catch (error) {
      res.status(500).json({
        message: "Lỗi Server",
      });
    }
  },
};

module.exports = UserController;
