using ordermateAPI.Models;

namespace ordermateAPI.Services.Interfaces;

public interface IProductOptionService
{
    Task<List<ProductOptionModel>> GetByProductId(int productId);
}