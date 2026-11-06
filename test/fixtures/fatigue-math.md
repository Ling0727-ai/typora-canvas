**步骤一：由特征点建立材料疲劳直线。** 对称循环点为$A'(0,\sigma_{-1})$，脉动循环点为$D'(\sigma_0/2,\sigma_0/2)$。采用两点间的直线近似，设其方程为$\sigma_a=b+c\sigma_m$。代入两点，得：

$$b=\sigma_{-1},\qquad
c=\dfrac{\sigma_0/2-\sigma_{-1}}{\sigma_0/2}
=1-\dfrac{2\sigma_{-1}}{\sigma_0}=-\varphi_\sigma$$

于是材料疲劳边界为：

$$\boxed{\sigma_a=\sigma_{-1}-\varphi_\sigma\sigma_m}$$

这是所采用的线性近似模型，并非仅由应力定义就能推出的普遍材料定律。若题目给$\sigma_{-1}$与$\sigma_0$，可先由$\varphi_\sigma=2\sigma_{-1}/\sigma_0-1$求系数；本例已给$\varphi_\sigma$，则反过来求$\sigma_0$。由材料脉动循环满足$\sigma_m=\sigma_a=\sigma_0/2$，代入疲劳直线：

$$\dfrac{\sigma_0}{2}+\varphi_\sigma\dfrac{\sigma_0}{2}=\sigma_{-1}
\quad\Longrightarrow\quad
\boxed{\sigma_0=\dfrac{2\sigma_{-1}}{1+\varphi_\sigma}}$$

本例$\sigma_0=2\times170/(1+0.2)\approx283.33\,\mathrm{MPa}$，故$D'\approx(141.67,141.67)\,\mathrm{MPa}$。两坐标之和$283.33<340$，该点未被屈服边界截断，可作为材料疲劳线上的脉动极限点。
