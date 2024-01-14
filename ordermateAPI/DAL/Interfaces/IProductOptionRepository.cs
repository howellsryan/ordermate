using ordermateAPI.DAL.Models;

namespace ordermateAPI.DAL.Interfaces;

public interface IProductOptionRepository
{
    Task<IEnumerable<ProductOptionModel>> GetByProductId(int productId);
}